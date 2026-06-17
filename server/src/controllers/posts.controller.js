// In-memory data store for demonstration
const posts = [];

/**
 * @desc    Get all posts
 * @route   GET /api/v1/posts
 * @access  Public
 */
export const getPosts = (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      count: posts.length,
      data: posts
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a post (e.g. from scraping content)
 * @route   POST /api/v1/posts
 * @access  Public
 */
export const createPost = (req, res, next) => {
  try {
    const { author, content, postUrl, timestamp } = req.body;

    if (!author || !content) {
      return res.status(400).json({
        success: false,
        message: 'Author and content are required fields'
      });
    }

    const newPost = {
      id: posts.length + 1,
      author,
      content,
      postUrl: postUrl || '',
      timestamp: timestamp || new Date().toISOString(),
      createdAt: new Date()
    };

    posts.push(newPost);

    res.status(201).json({
      success: true,
      data: newPost
    });
  } catch (error) {
    next(error);
  }
};
